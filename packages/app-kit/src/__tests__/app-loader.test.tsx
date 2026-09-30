import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppLoader } from "../feedback/app-loader";

/**
 * The boot screen's one behaviour: it waits before it appears.
 *
 * Worth a test rather than trusting the CSS, because both halves are easy to
 * lose. Drop the delay and every fast boot flashes a spinner for one frame;
 * drop the appearance and a hung boot is a blank screen again, which is
 * precisely the ambiguity that made D3.4's boot bug expensive to find.
 *
 * **The delay is counted from the page load** (`D31.3`, ADR-0080 §5), so the
 * clock here is `performance.now()`, pinned to the fake timers: the page
 * "loads" when each test starts, and advancing the timers advances it.
 */

beforeEach(() => {
  vi.useFakeTimers();

  const loadedAt = Date.now();

  vi.spyOn(performance, "now").mockImplementation(() => Date.now() - loadedAt);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AppLoader", () => {
  it("draws nothing for the first moments", () => {
    render(<AppLoader />);

    // The ground is painted from the first frame — what is absent is the
    // spinner, not the background, so the app never flashes white.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears once the wait is long enough to be worth explaining", () => {
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

  it("a second boot gate shows the loader without a second delay", () => {
    // The session's gate: its loader appears after the page's quarter-second.
    const session = render(<AppLoader />);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // The settings' gate replaces it, and the delay is already spent.
    session.unmount();
    render(<AppLoader />);

    expect(screen.getByRole("status")).toHaveTextContent("Starting…");
  });

  it("a gate that opened early leaves the next one only the rest of the delay", () => {
    const session = render(<AppLoader />);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    session.unmount();

    render(<AppLoader />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // 150 ms more makes 250 since the page loaded, not 250 since this mount.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
