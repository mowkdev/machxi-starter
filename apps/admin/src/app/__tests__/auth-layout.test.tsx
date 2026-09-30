import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";

/**
 * The login shell's structure and the values it is drawn with (`D11.7`,
 * ADR-0054 §7; redrawn at `D31.2` as one centred card, ADR-0080 §3).
 *
 * Rendered through `renderApp` rather than by mounting `AuthLayout` with
 * props, because half of what is under test is a **wiring** claim: the lede is
 * the route's `staticData.description` travelling on `D11.3`'s channel, and a
 * hand-passed string would prove the shell renders a paragraph while the route
 * quietly declared nothing.
 *
 * jsdom lays nothing out, so — the D8 precedent — the geometry is asserted as
 * the class strings that produce it, and `e2e/login.spec.ts` is where those
 * become measured pixels. The pair is the point: a class Tailwind never
 * generated passes here and fails there.
 */
describe("the login shell", () => {
  it("is one 400px card, centred on a gradient ground drawn from tokens", async () => {
    renderApp({ initialPath: "/login" });

    const heading = await screen.findByRole("heading", {
      name: "Sign in",
      level: 1,
    });

    const ground = document.querySelector('[data-slot="auth-ground"]');
    const card = heading.closest('[data-slot="card"]');

    /*
     * Centred on both axes, and this is the assertion that says so: the
     * `D11.7` column sat at the ground's left with no `justify-*`, and a lost
     * `justify-center` would bring it back with nothing else noticing.
     */
    expect(ground).toHaveClass(
      "min-h-svh",
      "items-center",
      "justify-center",
      "bg-background",
    );
    /*
     * The ground's paint is a gradient between two tokens, named as classes —
     * and no inline style, which is where the hairline grid lived.
     */
    expect(ground).toHaveClass(
      "bg-linear-to-br",
      "from-background",
      "to-primary-tint",
    );
    expect(ground).not.toHaveAttribute("style");

    // One card, the ground's only child, holding the heading.
    expect(card).not.toBeNull();
    expect(card?.parentElement).toBe(ground);
    expect(ground?.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(card).toHaveClass("max-w-[400px]");
  });

  it("stacks the brand line, the 28/34 heading and the route's lede above the form, in the card", async () => {
    renderApp({ initialPath: "/login" });

    const heading = await screen.findByRole("heading", {
      name: "Sign in",
      level: 1,
    });

    expect(heading).toHaveClass(
      "text-[28px]",
      "leading-[34px]",
      "font-semibold",
    );
    /*
     * The brand line on §3's caps rung, asserted rather than merely present:
     * this and the lede below are the two values the `D11.7` amendment newly
     * decides, so they are the two that would otherwise be re-tuned by eye
     * with a green gate.
     */
    expect(screen.getByText("machxi admin")).toHaveClass(
      "text-[11px]",
      "leading-4",
      "font-semibold",
      "tracking-[0.07em]",
      "uppercase",
    );

    /*
     * The lede is the login route's `staticData.description`, resolved through
     * `useRouteDescription`. Asserting the *catalogue's* sentence is what makes
     * this a wiring test: the key has to exist, the route has to declare it,
     * and the shell has to read it.
     */
    const lede = screen.getByText("Staff accounts only.");

    expect(lede).toHaveAttribute("data-slot", "auth-description");
    // A lede takes §3's 14/20 body rung, not the 13px meta line the shell's
    // page-header band uses — §7's own distinction, applied here.
    expect(lede).toHaveClass("text-[14px]", "leading-5");
    /*
     * Inside the one card with the form (ADR-0080 §3), and above it: the card
     * holds everything the screen says, in reading order.
     */
    const email = screen.getByLabelText("Email");
    const card = lede.closest('[data-slot="card"]');

    expect(card).not.toBeNull();
    expect(card).toContainElement(email);
    expect(
      lede.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("gives the card §3's 20px padding and 16px stack, and its controls the 38px login rung", async () => {
    renderApp({ initialPath: "/login" });

    const email = await screen.findByLabelText("Email");
    const card = email.closest('[data-slot="card"]');

    /*
     * `p-5` and `gap-4`, and neither of the primitive's own left behind them:
     * `cn` merges through `tailwind-merge`, so the primitive's `py-6` and
     * `gap-6` have to have been *removed* rather than merely followed. Two
     * competing values would let source order decide the geometry.
     */
    expect(card).toHaveClass("p-5", "gap-4");
    expect(card).not.toHaveClass("py-6");
    expect(card).not.toHaveClass("gap-6");

    for (const control of [
      email,
      screen.getByLabelText("Password"),
      screen.getByRole("button", { name: "Sign in" }),
    ]) {
      expect(control).toHaveClass("h-[38px]");
      expect(control).not.toHaveClass("h-9");
      expect(control).toHaveClass("text-[13px]");
    }

    /*
     * The `md:` twin, on the field alone. `Input` ships `text-base md:text-sm`
     * and takes its own size back from 768px up, so a bare `text-[13px]` here
     * would be a control that silently grows a size on a desktop — which is
     * exactly what no jsdom assertion can see, and why `e2e/login.spec.ts`
     * measures the computed size at a viewport above `md`.
     */
    expect(email).toHaveClass("md:text-[13px]");
  });
});
