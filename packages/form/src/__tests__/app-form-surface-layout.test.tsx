import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SURFACES, renderSurface } from "./support/surface-harness";

/**
 * The inversion's structural consequences (`D8.9`, ADR-0048 §4).
 *
 * These are the assertions that keep the inversion honest where jsdom can
 * still see it. The layout itself — a long form scrolling its body while the
 * title and Save stay put — is `D8.12`'s browser walk.
 *
 * **Split out of the admin's `app-form-surface.test.tsx` at `D22.3`**
 * (ADR-0077 §4) when it moved into this package, with its cases unchanged;
 * the three shells it renders come from `support/surface-harness.tsx`.
 */
describe("the inverted frame", () => {
  it.each(SURFACES)(
    "keeps the form-level error inside the %s's form and inside the locked FieldSet",
    async (surface) => {
      renderSurface({ isPending: true, surface });

      await screen.findByLabelText("Name");

      /*
       * The error is forced from **outside** the surface, because the lock
       * disables everything inside it and this assertion needs both at once:
       * a rendered message *and* a disabled `FieldSet`. `fireEvent`, not
       * `user-event`, because under `dialog` and `drawer` the modal's overlay
       * makes the rest of the document `pointer-events: none`.
       */
      fireEvent.click(
        // `{ hidden: true }`: under `dialog` and `drawer` this button is
        // outside the modal, so Radix has `aria-hidden` over it.
        screen.getByRole("button", { hidden: true, name: "Fail" }),
      );

      /*
       * On the message itself, not on the element that would host it: a query
       * for `FieldGroup` would stay green if `AppFormError` were deleted
       * outright, which is precisely the property this test exists to pin.
       */
      const error = await screen.findByText("Saving failed");

      /*
       * `AppFormError` moved up one file at `D8.9`, so ADR-0035's guarantee
       * needs an assertion that is about structure rather than about which
       * module renders it: the failure `applyServerErrors` could not land on a
       * field reaches the operator, inside the form that produced it and
       * inside the lock that froze it. Nothing in the repository asserted the
       * error's nesting before — the shipped suite pins the *footer* inside
       * the lock, which is a different claim.
       */
      expect(error.closest("form")).not.toBeNull();
      expect(error.closest('[data-slot="field-set"][disabled]')).not.toBeNull();
    },
  );

  it("stops the FieldSet laying out, so the rows are the form's own grid children", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    const fieldSet = document.querySelector('[data-slot="field-set"]');

    /*
     * `display: contents` removes the box, not the element — which is what
     * lets the container's row template on the `<form>` reach the three rows
     * while `disabled` and `aria-busy` still apply to everything inside.
     */
    expect(fieldSet).toHaveClass("contents");
  });

  it("bounds the dialog on DialogContent, and keeps its title and footer outside the scrolling element", async () => {
    renderSurface({ surface: "dialog" });

    await screen.findByLabelText("Name");

    const content = document.querySelector('[data-slot="dialog-content"]');
    const body = document.querySelector('[data-slot="surface-body"]');

    /*
     * **On `DialogContent`, not on the column** (`D8.11`, ADR-0048 §4). The
     * shipped dialog carried no `className` and therefore no `max-h` at all —
     * the element is centred by transform — so a bound on the inner form
     * bounded nothing and a long form grew the modal past the viewport.
     */
    expect(content).toHaveClass("max-h-[calc(100svh-2rem)]");
    /*
     * Asserted separately and as explicitly as the bound itself, because it
     * is the class that makes the bound *reach* the column: `DialogContent`
     * is `grid` and its implicit row track is `auto`, which sizes to the
     * column's content instead of shrinking to the container's `max-height`.
     * Without it the column's `1fr` body row resolves against content height
     * and `overflow-y-auto` never engages — and every other assertion here
     * would still be green.
     */
    expect(content).toHaveClass("grid-rows-[minmax(0,1fr)]");

    expect(body).toHaveClass("overflow-y-auto", "min-h-0");
    expect(
      body?.contains(screen.getByRole("heading", { name: "Demo record" })),
    ).toBe(false);
    expect(body?.contains(screen.getByRole("button", { name: "Save" }))).toBe(
      false,
    );
  });

  it("keeps the drawer's title and footer outside the scrolling element", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    const body = document.querySelector('[data-slot="surface-body"]');

    expect(body).toHaveClass("overflow-y-auto", "min-h-0");
    expect(
      body?.contains(screen.getByRole("heading", { name: "Demo record" })),
    ).toBe(false);
    expect(body?.contains(screen.getByRole("button", { name: "Save" }))).toBe(
      false,
    );
  });

  it("gives the page variant no scrolling element at all", async () => {
    renderSurface({ surface: "page" });

    await screen.findByLabelText("Name");

    /*
     * A `page` surface renders under `fullHeight: false`, so ADR-0037's chain
     * gives its parent no definite height — an `overflow-y-auto min-h-0` body
     * inside an unbounded parent would scroll nothing and fix nothing. The
     * document scrolls, as it does today.
     */
    expect(
      document.querySelector('[data-slot="surface-body"]'),
    ).not.toHaveClass("overflow-y-auto");
  });

  it("keeps the two widths Instrument leaves alone, and bands the drawer", async () => {
    const { unmount } = renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    /*
     * 512px, which the reference draws and `sm:max-w-lg` already was — the
     * dialog's 600 is the one width `D11.5` moves (ADR-0054 §7).
     */
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass(
      "w-full",
      "sm:max-w-lg",
    );
    /*
     * The bands, through the whole stack rather than in the package alone:
     * these are the classes an `AppFormSurface` consumer actually renders, so
     * a container that grew a band the wrapper then overrode would show up
     * here and nowhere else.
     */
    expect(document.querySelector('[data-slot="surface-body"]')).toHaveClass(
      "p-6",
    );
    expect(document.querySelector('[data-slot="surface-footer"]')).toHaveClass(
      "min-h-16",
      "border-t",
      "bg-muted",
      "px-6",
    );

    unmount();
    renderSurface({ surface: "page" });

    await screen.findByLabelText("Name");

    // The class `AppFormPage` used to hardcode, now the `md` size token.
    expect(document.querySelector('[data-slot="record-surface"]')).toHaveClass(
      "max-w-2xl",
    );
  });

  it("hands the footer band a full-width row instead of the retired margin", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    const row = screen
      .getByRole("button", { name: "Save" })
      .closest("div") as HTMLElement;

    /*
     * `mt-12` was the fields-to-footer distance the inversion made the shells
     * carry (`D8.9`); the 64px band and its top rule are that distance now, so
     * a 3rem margin inside the band would push the actions out of it
     * (`D11.5`, ADR-0054 §7). `w-full` because the band is `flex items-center`
     * and would otherwise size this row to its content.
     */
    expect(row).not.toHaveClass("mt-12");
    expect(row).toHaveClass("w-full", "justify-end");
  });

  it("stacks the fields at the 20px rung the reference draws", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    /*
     * `FieldGroup`'s own `gap-7` is 28 and ADR-0047 keeps the primitive
     * byte-identical, so §7's 20px stack is spelled where the group is
     * rendered — which is this package, because the fields are the app's body
     * content and `RecordSurface` is content-agnostic.
     */
    expect(document.querySelector('[data-slot="field-group"]')).toHaveClass(
      "gap-5",
    );
  });
});
