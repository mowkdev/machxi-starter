import { beforeEach, describe, expect, it, vi } from "vitest";

import { createErrorReporter } from "../feedback/error-reporting";

/**
 * ADR-0066 §3: the seam is off unless a DSN is configured, and the adapter is
 * loaded only inside that branch. Certified here since `D22.1` (ADR-0077 §1
 * and §4), where the factory moved from both apps.
 *
 * `loads` counts calls of the loader an app passes — in an app that is the
 * `import()` of its `reporter.ts` — because "no dependency loaded" is the
 * decision, not merely "nothing was reported".
 */

let loads = 0;
const report = vi.fn();

const load = () => {
  loads += 1;

  return Promise.resolve({ report });
};

beforeEach(() => {
  loads = 0;
  report.mockReset();
});

describe("createErrorReporter", () => {
  it("builds nothing without a DSN", async () => {
    expect(createErrorReporter(undefined, load)).toBeUndefined();

    await Promise.resolve();

    expect(loads).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it("loads the adapter once and hands it the DSN", async () => {
    const reporter = createErrorReporter(
      "https://key@errors.example.com/1",
      load,
    );

    expect(reporter).toBeDefined();
    // Still nothing: the load is inside the call, not inside the factory, so
    // a build with a DSN that never fails still never downloads the chunk.
    expect(loads).toBe(0);

    reporter?.(new Error("first"), { boundary: "app" });
    reporter?.(new Error("second"));

    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(2);
    });

    expect(loads).toBe(1);
    expect(report).toHaveBeenNthCalledWith(
      1,
      "https://key@errors.example.com/1",
      expect.any(Error),
      { boundary: "app" },
    );
  });

  it("swallows an adapter that throws", async () => {
    report.mockImplementationOnce(() => {
      throw new Error("reporter exploded");
    });

    const reporter = createErrorReporter(
      "https://key@errors.example.com/1",
      load,
    );

    expect(() => {
      reporter?.(new Error("boom"));
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(1);
    });
  });

  it("swallows an adapter that will not load", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("chunk missing")));
    const reporter = createErrorReporter(
      "https://key@errors.example.com/1",
      failing,
    );

    expect(() => {
      reporter?.(new Error("boom"));
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(failing).toHaveBeenCalledTimes(1);
    });
    expect(report).not.toHaveBeenCalled();
  });
});
