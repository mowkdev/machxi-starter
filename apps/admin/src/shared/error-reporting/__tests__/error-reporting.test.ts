import { describe, expect, it, vi } from "vitest";

/**
 * The reporting seam's binding (ADR-0066 §3, ADR-0077 §1 and §4).
 *
 * The factory — no DSN no reporter, the adapter loaded once and inside the
 * branch, every failure swallowed — is certified in `@repo/app-kit`, which
 * has owned it since `D22.1`. What this app binds is its DSN and its adapter,
 * and this is the smoke test that both arrived: with a DSN configured, a
 * report reaches *this app's* `reporter.ts`.
 */

const DSN = "https://key@errors.example.com/1";
const report = vi.fn();

vi.mock("@/shared/config", () => ({
  config: { VITE_ERROR_REPORTING_DSN: DSN },
}));

vi.mock("../reporter.js", () => ({ report }));

describe("reportError", () => {
  it("hands this app's adapter this app's DSN", async () => {
    const { reportError } = await import("../index.js");

    reportError?.(new Error("boom"), { boundary: "app" });

    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(1);
    });

    expect(report).toHaveBeenCalledWith(DSN, expect.any(Error), {
      boundary: "app",
    });
  });
});
