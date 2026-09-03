import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppLoader } from "../feedback/app-loader";

/**
 * The boot screen's one behaviour: it waits before it appears.
 *
 * Worth a test rather than trusting the CSS, because both halves are easy to
 * lose. Drop the delay and every fast boot flashes a spinner for one frame;
 * drop the appearance and a hung boot is a blank screen again, which is
 * precisely the ambiguity that made D3.4's boot bug expensive to find.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("AppLoader", () => {
  it("draws nothing for the first moments", () => {
    vi.useFakeTimers();

    render(<AppLoader />);

    // The ground is painted from the first frame — what is absent is the
    // spinner, not the background, so the app never flashes white.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears once the wait is long enough to be worth explaining", () => {
    vi.useFakeTimers();

    render(<AppLoader delayMs={250} />);

    // Inside `act`, or the timer fires but React never flushes the state it
    // set, and the assertion below fails for a reason that is not the app's.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Starting…");
  });

  it("can be shown immediately", () => {
    render(<AppLoader delayMs={0} label="Signing you in…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
  });
});
