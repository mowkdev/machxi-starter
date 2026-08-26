import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Banner } from "@repo/ui/compositions/banner";
import { UiStringsProvider } from "@repo/ui/ui-strings";

/**
 * The first composition's suite (ADR-0048 §3, `D8.2`).
 *
 * What is asserted here is the ceiling ADR-0047 §Component-conventions sets:
 * roles, accessible names, `data-*` attributes and the composition's own
 * decisions. The one apparent exception is the `onDismiss` case, and it is not
 * a widening — a `fireEvent.click` on a control **this component itself
 * renders** asks whether the component honours its own contract, not whether a
 * person can complete a journey. The gestures that stay out are the ones that
 * need `user-event`'s pointer and keyboard simulation against a real router or
 * form; those are still the consuming app's. ADR-0047 carries the clause
 * (amended at `D8.2`).
 *
 * The `@repo/contracts` boundary is not tested here because it cannot be
 * faked: that package is not among `packages/ui`'s dependencies, so an import
 * of it is a red `check-types` rather than a failing assertion.
 *
 * Both variants are polite live regions, so `getByRole("status")` is what
 * finds either one and `data-variant` is what tells them apart — the variant
 * is severity, not announcement level (ADR-0048 §3, amended `D8.2`).
 */
describe("Banner", () => {
  it("renders an info notice as a polite status", () => {
    render(<Banner message="Pseudo-locale is on." variant="info" />);

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent("Pseudo-locale is on.");
    expect(banner).toHaveAttribute("data-slot", "banner");
    expect(banner).toHaveAttribute("data-variant", "info");
  });

  it("renders a dismissible warning, also as a polite status", () => {
    render(
      <Banner dismissible message="You are impersonating." variant="warning" />,
    );

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent("You are impersonating.");
    expect(banner).toHaveAttribute("data-variant", "warning");
    /*
     * The severity variant does not change the announcement level and does not
     * take the dismiss control away — both are asserted here because the first
     * draft of this component got the first one wrong (ADR-0048 §3, amended).
     */
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("is info by default, so a caller that names no variant gets the quiet one", () => {
    render(<Banner message="A notice." />);

    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "info");
  });

  it("renders no dismiss control by default", () => {
    render(<Banner message="A notice." />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders no dismiss control under dismissible={false}", () => {
    render(<Banner dismissible={false} message="A notice." />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names its dismiss control from UiStrings", () => {
    render(
      <UiStringsProvider strings={{ dismiss: "Aizvērt paziņojumu" }}>
        <Banner dismissible message="A notice." />
      </UiStringsProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Aizvērt paziņojumu" }),
    ).toBeInTheDocument();
  });

  it("falls back to English with no provider mounted", () => {
    render(<Banner dismissible message="A notice." />);

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("hands the dismissal back and holds no dismissed state of its own", () => {
    const onDismiss = vi.fn();

    render(<Banner dismissible message="A notice." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    /*
     * Still mounted afterwards, which is the assertion that the component is
     * dumb: whether a dismissed banner disappears is the caller's to decide,
     * and a component that hid itself here would have decided it (ADR-0048
     * §3).
     */
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
