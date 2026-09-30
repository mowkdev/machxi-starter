import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "@/shared/ui";
import { renderApp, renderWithProviders } from "@/test/render";

/**
 * The sign-in shell's structure (ADR-0054 §7).
 *
 * Structural assertions rather than pixel ones, which is the only kind jsdom
 * can honestly make (ADR-0036): the heading exists and is an `h1`, the lede is
 * present only when the caller has one, and the ground holds the one card
 * ADR-0080 §3 draws. What a browser has to confirm is the *look*, and the plan
 * says so rather than pretending a suite can.
 */
describe("AuthLayout", () => {
  it("heads the screen with an h1 the router's title fills", () => {
    renderWithProviders(
      <AuthLayout description={undefined} title="Sign in">
        <p>form</p>
      </AuthLayout>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sign in",
    );
  });

  it("renders one centred card holding the brand line, the title and the page", () => {
    const { container } = renderWithProviders(
      <AuthLayout description={undefined} title="Sign in">
        <p>form</p>
      </AuthLayout>,
    );

    /*
     * ADR-0080 §3, bound through this app's door: one card on the gradient
     * ground, holding everything the screen says. The package certifies the
     * values; this is the smoke test that the door serves that layout.
     */
    const ground = container.querySelector('[data-slot="auth-ground"]');
    const cards = ground?.querySelectorAll('[data-slot="card"]') ?? [];

    expect(ground).toHaveClass("justify-center", "to-primary-tint");
    expect(cards).toHaveLength(1);

    const brand = screen.getByText("machxi account");
    const heading = screen.getByRole("heading", { level: 1 });

    expect(cards[0]).toContainElement(brand);
    expect(cards[0]).toContainElement(heading);
    expect(cards[0]).toContainElement(screen.getByText("form"));
    // The brand line comes first in the card's reading order.
    expect(
      brand.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no lede element when the route declares no description", () => {
    const { container } = renderWithProviders(
      <AuthLayout description={undefined} title="Sign in">
        <p>form</p>
      </AuthLayout>,
    );

    expect(
      container.querySelector('[data-slot="auth-description"]'),
    ).toBeNull();
  });

  it("takes the title and the lede from the route it frames", async () => {
    renderApp({ initialPath: "/login" });

    /*
     * Through the router rather than by props, because the claim is the
     * channel: `_auth.login.tsx` declares two keys, `useRouteTitle` and
     * `useRouteDescription` resolve them, and the shell renders words. A test
     * that passed the strings in would prove the shell and not the wiring.
     */
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeInTheDocument();

    expect(
      screen.getByText("Use the email address your account was created with."),
    ).toBeInTheDocument();
  });
});
