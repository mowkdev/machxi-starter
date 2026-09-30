import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "../layouts/auth-layout";

/**
 * The auth layout's own geometry (`D31.2`, ADR-0080 §3 over ADR-0054 §7).
 *
 * jsdom lays nothing out, so — the D8 precedent — the geometry is asserted as
 * the class strings that produce it, and the admin's `e2e/login.spec.ts` is
 * where they become measured pixels. No i18n instance is mounted, so the brand
 * line renders its key; the apps' suites assert the sentence.
 */
const renderLayout = (description?: string) =>
  render(
    <AuthLayout description={description} title="Sign in">
      <form aria-label="The form">
        <input aria-label="Email" />
      </form>
    </AuthLayout>,
  );

describe("AuthLayout", () => {
  it("the auth layout centres one card on a gradient drawn from tokens", () => {
    renderLayout("A lede.");

    const ground = document.querySelector('[data-slot="auth-ground"]');

    // Centred on both axes: a flex row with both alignments set.
    expect(ground).toHaveClass(
      "flex",
      "min-h-svh",
      "items-center",
      "justify-center",
    );
    /*
     * The gradient runs `--background` into `--primary-tint`, painted over
     * the `--background` ground so the tint's alpha has a surface. Tokens by
     * name, and no inline paint: the hairline grid was an inline `style`, and
     * a restored one fails the second assertion.
     */
    expect(ground).toHaveClass(
      "bg-background",
      "bg-linear-to-br",
      "from-background",
      "to-primary-tint",
    );
    expect(ground).not.toHaveAttribute("style");

    // One card, the ground's only child, at §7's width and card rungs.
    const cards = ground?.querySelectorAll('[data-slot="card"]') ?? [];

    expect(cards).toHaveLength(1);
    expect(ground?.children).toHaveLength(1);

    const card = cards[0];

    expect(card).toHaveClass("max-w-[400px]", "p-5", "gap-4");
    expect(card).not.toHaveClass("py-6");

    // The card holds the brand line, the heading, the lede and the controls.
    const heading = screen.getByRole("heading", { level: 1, name: "Sign in" });

    expect(card).toContainElement(heading);
    expect(card).toContainElement(screen.getByText("brand.authTagline"));
    expect(card).toContainElement(screen.getByText("A lede."));
    expect(card).toContainElement(
      screen.getByRole("textbox", { name: "Email" }),
    );
  });

  it("renders no lede element when the screen has none", () => {
    renderLayout();

    expect(document.querySelector('[data-slot="auth-description"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sign in",
    );
  });
});
