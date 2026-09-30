import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

/**
 * The sidebar's version footer, for a labelled build (ADR-0081 §3, `D32.2`).
 *
 * The runner's `define` is built from nothing set (`vitest.config.ts`), so a
 * label can only reach this suite by replacing the two constants the
 * configuration door exports — which is what a build with
 * `--build-arg APP_VERSION=… --build-arg GIT_SHA=…` hands the same door. The
 * rest of the door is the real one. The substitution itself is
 * `version-footer.test.tsx`'s claim, and the image's is the plan's
 * `docker build` check.
 */
vi.mock("@/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/config")>()),
  APP_VERSION: "9.9.9",
  GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
}));

describe("the sidebar's version footer", () => {
  it("the footer shows the release label and the short commit", async () => {
    renderApp({ initialPath: "/", store: authenticatedAs() });

    await screen.findByRole("heading", { name: "Dashboard", level: 1 });

    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    /*
     * The label as given, and the commit's first seven characters — never the
     * full forty, which `/health` answers and a 240px drawer cannot hold.
     */
    expect(footer?.textContent).toBe("9.9.9 · 0123456");
  });
});
