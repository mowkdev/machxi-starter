import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";

/**
 * The login shell's structure and the values it is drawn with (`D11.7`,
 * ADR-0054 §7).
 *
 * Rendered through `renderApp` rather than by mounting `AuthLayout` with
 * props, because half of what is under test is a **wiring** claim: the lede is
 * the route's `staticData.description` travelling on `D11.3`'s channel, and a
 * hand-passed string would prove the shell renders a paragraph while the route
 * quietly declared nothing.
 *
 * jsdom lays nothing out, so — the D8 precedent — the geometry is asserted as
 * the class strings and the inline paint that produce it, and
 * `e2e/login.spec.ts` is where those become measured pixels. The pair is the
 * point: a class Tailwind never generated passes here and fails there.
 */
describe("the login shell", () => {
  it("is a 400px column on a 48px hairline ground", async () => {
    renderApp({ initialPath: "/login" });

    await screen.findByRole("heading", { name: "Sign in", level: 1 });

    const ground = document.querySelector('[data-slot="auth-ground"]');
    const column = document.querySelector('[data-slot="auth-column"]');

    expect(ground).toHaveClass("min-h-svh", "items-center", "bg-background");
    /*
     * The ground's own paint, read off the inline style: the 48px module and
     * the fact that its colour is the `--border` token rather than a literal
     * — §2's rule, which a hex here would break silently.
     */
    expect(ground).toHaveStyle({ backgroundSize: "48px 48px" });
    expect(ground?.getAttribute("style")).toContain("var(--border)");
    /*
     * Left-aligned, and this is the assertion that says so: the ground is a
     * flex row with no `justify-*`, so the column sits at flex-start. A
     * `justify-center` added later would restore the centred `login-01`
     * composition this step replaced, and nothing else here would notice.
     */
    expect(ground?.className).not.toContain("justify-");

    expect(column).toHaveClass("max-w-[400px]");
  });

  it("stacks the brand line, the 28/34 heading and the route's lede above the card", async () => {
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
     * And it is outside the card, which is the move this step made. A `p`
     * still inside `CardHeader` would render identically and read identically;
     * only its ancestry says which composition shipped.
     */
    expect(lede.closest('[data-slot="card"]')).toBeNull();
  });

  it("gives the card §3's 20px padding and its controls the 38px login rung", async () => {
    renderApp({ initialPath: "/login" });

    const email = await screen.findByLabelText("Email");
    const card = email.closest('[data-slot="card"]');

    /*
     * `p-5`, and no `py-6` left behind it: `cn` merges through
     * `tailwind-merge`, so the primitive's own padding has to have been
     * *removed* rather than merely followed. Two competing paddings would let
     * source order decide the geometry.
     */
    expect(card).toHaveClass("p-5");
    expect(card).not.toHaveClass("py-6");

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
