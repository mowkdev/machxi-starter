import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsLayout } from "@repo/ui/compositions/settings-layout";

/**
 * The account area's arrangement (ADR-0053 §4, ADR-0054 §7, `D11.8`).
 *
 * **The class strings are the assertions**, for the reason `app-shell`'s suite
 * gives: jsdom lays nothing out, so nothing here proves the nav actually sits
 * beside the content at 1440px or above it at 375px. What it proves is that
 * the inputs to that layout are the ones the record names — a composition that
 * dropped `md:w-[220px]`, or grew an outer `p-4` that inset an already-inset
 * page a second time, would render identically in this harness.
 *
 * The two claims that are not about pixels are the ones the deliverable's
 * done-when names: the nav's children arrive **rendered**, and nothing here
 * knows what a route is. The second is asserted by the package's dependency
 * graph rather than by a case — `@tanstack/react-router` is not a dependency
 * of `@repo/ui`, so an import would fail `check-types` — and by the first case
 * below, which hands it plain anchors and gets them back untouched.
 */

const SECTIONS = ["Profile", "Security", "Preferences"] as const;

const Nav = () => (
  <>
    {SECTIONS.map((section) => (
      <a href={`/account/${section.toLowerCase()}`} key={section}>
        {section}
      </a>
    ))}
  </>
);

const renderLayout = (
  props: Partial<Parameters<typeof SettingsLayout>[0]> = {},
) =>
  render(
    <SettingsLayout nav={<Nav />} navLabel="Account sections" {...props}>
      <p>Section content</p>
    </SettingsLayout>,
  );

const layout = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-slot="settings-layout"]')!;

const content = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-slot="settings-content"]')!;

describe("SettingsLayout", () => {
  describe("the division with the app", () => {
    it("renders the nav's nodes as they arrive, inside a named landmark", () => {
      renderLayout();

      const nav = screen.getByRole("navigation", { name: "Account sections" });

      /*
       * Rendered children, not section data: the composition is handed
       * anchors and returns anchors. The real consumer hands it router
       * `<Link>`s carrying their own active state, and the point of this case
       * is that the two are the same thing to this component.
       */
      for (const section of SECTIONS) {
        expect(screen.getByRole("link", { name: section })).toBeInTheDocument();
      }
      expect(nav.children).toHaveLength(SECTIONS.length);
    });

    it("puts the section's own content in the content pane, beside the nav", () => {
      renderLayout();

      expect(content()).toHaveTextContent("Section content");
      /*
       * Siblings under one root, in nav-then-content order — the order a
       * keyboard and a screen reader walk them in, and the one thing about
       * this layout that is true at every viewport.
       */
      expect(
        [...layout().children].map((el) => el.getAttribute("data-slot")),
      ).toEqual(["settings-nav", "settings-content"]);
    });

    it("names the landmark from the prop rather than from a default", () => {
      renderLayout({ navLabel: "Konta sadaļas" });

      expect(
        screen.getByRole("navigation", { name: "Konta sadaļas" }),
      ).toBeInTheDocument();
      /*
       * The reason `navLabel` is not a `UiStrings` key: there is no English
       * default to fall back to, so a localised app cannot end up with a
       * landmark the design system named in the wrong language.
       */
      expect(
        screen.queryByRole("navigation", { name: "Account sections" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("the geometry ADR-0054 §7 names", () => {
    it("stacks below md and becomes a row above it, over the 32px gap", () => {
      renderLayout();

      expect(layout()).toHaveClass("flex", "flex-col", "gap-8", "md:flex-row");
    });

    it("keeps the nav column at 220px and lets it wrap only while stacked", () => {
      renderLayout();

      const nav = screen.getByRole("navigation", { name: "Account sections" });

      expect(nav).toHaveClass("shrink-0", "md:w-[220px]", "md:flex-col");
      /*
       * `flex-wrap` is the stacked row's answer to a narrow viewport, and
       * `md:flex-nowrap` is what stops it becoming a *second column* once the
       * direction turns: a wrapping column with a definite height — which this
       * one has, stretched by the row — silently splits its items in two
       * rather than overflowing, and nothing in either tier would see it.
       */
      expect(nav).toHaveClass("flex-wrap", "md:flex-nowrap");
    });

    it("caps the content column at 720px over the 16px card stack", () => {
      renderLayout();

      expect(content()).toHaveClass(
        "flex",
        "min-w-0",
        "max-w-[720px]",
        "flex-1",
        "flex-col",
        "gap-4",
      );
    });

    it("supplies no gutter of its own", () => {
      renderLayout();

      /*
       * `/account` is a document page, so ADR-0054 §5's page container already
       * spends the 16px gutter on it (`gap-4 p-4`, asserted in the shell's
       * suite). A padding class here would inset the area twice and no query
       * by role would notice — which is why this is a `not` on the class
       * rather than a look at the rendered box.
       *
       * The pattern covers **every** padding spelling and the `md:` variant
       * with them, because the regression this guards is not someone typing
       * `p-4` on the root: it is someone re-tuning the collapse and reaching
       * for `pt-6` or `md:p-4` while they are in there.
       */
      expect(layout().className).not.toMatch(/(^|\s|:)p[trblxyse]?-/);
    });
  });
});
