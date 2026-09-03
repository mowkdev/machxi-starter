import { beforeEach, describe, expect, it, vi } from "vitest";

import { createErrorReporter } from "../index.js";

/**
 * ADR-0066 §3: the seam is off unless a DSN is configured, and the adapter is
 * loaded only inside that branch.
 *
 * `imports` counts evaluations of the adapter module, because "no dependency
 * loaded" is the decision — not merely "nothing was reported".
 */

let imports = 0;
const report = vi.fn();

vi.mock("../reporter.js", () => {
  imports += 1;

  return { report };
});

beforeEach(() => {
  imports = 0;
  report.mockClear();
});

describe("createErrorReporter", () => {
  it("builds nothing without a DSN", async () => {
    expect(createErrorReporter(undefined)).toBeUndefined();

    await Promise.resolve();

    expect(imports).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it("loads the adapter once and hands it the DSN", async () => {
    const reporter = createErrorReporter("https://key@errors.example.com/1");

    expect(reporter).toBeDefined();
    // Still nothing: the import is inside the call, not inside the factory, so
    // a build with a DSN that never fails still never downloads the chunk.
    expect(imports).toBe(0);

    reporter?.(new Error("first"), { boundary: "app" });
    reporter?.(new Error("second"));

    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(2);
    });

    expect(imports).toBe(1);
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

    const reporter = createErrorReporter("https://key@errors.example.com/1");

    expect(() => {
      reporter?.(new Error("boom"));
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(1);
    });
  });
});
