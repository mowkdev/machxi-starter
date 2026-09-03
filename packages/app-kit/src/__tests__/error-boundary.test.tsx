import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "../feedback/error-boundary";
import { AppCrash } from "../router/defaults";

/**
 * The top-level boundary's three claims (ADR-0062 §2): it catches, it reports
 * once, and what it renders is copy rather than the error.
 *
 * `fallback` is passed explicitly here rather than letting `AppError` render,
 * because `AppError` resolves its sentence through i18next and this file has
 * no instance — mounting one would make these assertions about the catalogue.
 * The apps' own suites cover the localized surface.
 */
const Boom = (): never => {
  throw new Error("secret internals nobody should read");
};

/*
 * React logs a caught render error to `console.error` whatever the boundary
 * does with it. Silenced rather than tolerated, because a suite that prints a
 * stack on a passing test teaches everybody to ignore the output.
 */
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders its children while nothing throws", () => {
    render(
      <AppErrorBoundary fallback={<p>failed</p>}>
        <p>the app</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("the app")).toBeInTheDocument();
    expect(screen.queryByText("failed")).toBeNull();
  });

  it("catches a render throw and shows the fallback instead of the message", () => {
    render(
      <AppErrorBoundary fallback={<p>failed</p>}>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret internals");
  });

  it("reports the error once, named for the boundary and nothing else", () => {
    const report = vi.fn();

    render(
      <AppErrorBoundary fallback={<p>failed</p>} report={report}>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      boundary: "app",
    });
  });

  it("falls back to a surface with a way out when the caller names none", () => {
    /*
     * The claim ADR-0062 §2 grew at `D14.8`: a throw above the router takes
     * the shell with it, so a fallback with no action is a permanently dead
     * window. With no i18n instance mounted, i18next hands back the key —
     * which is enough to prove the *action* is rendered and is a button.
     */
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret internals");
  });

  it("reloads rather than clearing the flag, because the inputs have not changed", () => {
    const reload = vi.fn();

    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location);

    render(<AppCrash />);
    screen.getByRole("button").click();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("survives a build with no reporter, which is the default one", () => {
    expect(() => {
      render(
        <AppErrorBoundary fallback={<p>failed</p>}>
          <Boom />
        </AppErrorBoundary>,
      );
    }).not.toThrow();

    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
