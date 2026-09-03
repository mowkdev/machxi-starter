import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "@/shared/ui";
import { renderApp, renderWithProviders } from "@/test/render";

/**
 * The sign-in shell's structure (ADR-0054 §7).
 *
 * Structural assertions rather than pixel ones, which is the only kind jsdom
 * can honestly make (ADR-0036): the heading exists and is an `h1`, the lede is
 * present only when the caller has one, and the ground and the column are the
 * two elements §7 names. What a browser has to confirm is the *look*, and the
 * plan says so rather than pretending a suite can.
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

  it("renders the brand line above the title", () => {
    const { container } = renderWithProviders(
      <AuthLayout description={undefined} title="Sign in">
        <p>form</p>
      </AuthLayout>,
    );

    expect(container.querySelector('[data-slot="auth-column"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="auth-ground"]')).not.toBeNull();
    expect(container.textContent).toContain("machxi account");
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
