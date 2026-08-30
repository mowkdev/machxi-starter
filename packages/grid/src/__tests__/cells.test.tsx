import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RolesList, StatusBadge } from "../cells";
import { renderWithI18n } from "./support/render";

/**
 * The two value renderers, re-drawn at `D11.2` (ADR-0054 §4).
 *
 * What changed is presentation and nothing else: the same resource-agnostic
 * vocabulary of *words* decides the tone, the label still comes from
 * `common:options.<value>`, and the registry keys are untouched. So the cases
 * here are the ones a re-skin can get wrong — the tone a word maps to, the dot
 * being a *second* encoding rather than the only one, and the mono face the
 * record puts on a role.
 */

describe("the status dot", () => {
  const dotOf = (): Element | null =>
    document.querySelector('[data-slot="status-dot"] > span[aria-hidden]');

  it("reads a settled status as success", () => {
    renderWithI18n(<StatusBadge value="active" />);

    expect(dotOf()).toHaveClass("bg-success", "size-1.5", "rounded-full");
    // The word is still the meaning, and still the catalogue's — a colour that
    // was the only encoding would be an accessibility defect, and a hard-coded
    // English label would pass with no `common` namespace mounted.
    expect(screen.getByText("Aktīvs")).toBeInTheDocument();
  });

  it("reads a waiting status as warning", () => {
    // `invited` is staff's and `pending_verification` is users' (ADR-0017);
    // both are the same *word* to this renderer, which is what lets it live in
    // a package that knows neither population.
    renderWithI18n(<StatusBadge value="pending_verification" />);

    expect(dotOf()).toHaveClass("bg-warning");
  });

  it("reads anything else as neutral, disabled included", () => {
    /*
     * `disabled` rendered `destructive` until `D11.2`, which spent the
     * palette's one alarm colour on a row's ordinary resting state. ADR-0054
     * §4 says neutral, and this case is what stops the red coming back.
     */
    renderWithI18n(<StatusBadge value="disabled" />);

    expect(dotOf()).toHaveClass("bg-muted-foreground");
    expect(dotOf()).not.toHaveClass("bg-destructive");
  });

  it("renders the empty cell for a value that is not a status", () => {
    renderWithI18n(<StatusBadge value="" />);

    expect(dotOf()).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("the roles list", () => {
  it("renders each role as a mono badge on the radius scale", () => {
    renderWithI18n(<RolesList value={["active", "disabled"]} />);

    for (const label of ["Aktīvs", "Atspējots"]) {
      /*
       * `rounded-md` is 5px, §2's badge rung. The `Badge` primitive spells
       * `rounded-full`, which §2's own "nothing rounder than 8" forbids —
       * and ADR-0047 keeps that file byte-identical, so this is the sanctioned
       * surface saying so.
       */
      expect(screen.getByText(label)).toHaveClass(
        "font-mono",
        "rounded-md",
        "h-[26px]",
      );
    }
  });

  it("renders the empty cell for no roles", () => {
    renderWithI18n(<RolesList value={[]} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
