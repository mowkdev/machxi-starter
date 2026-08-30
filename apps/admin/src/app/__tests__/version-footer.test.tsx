import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

import packageJson from "../../../package.json";

/**
 * The sidebar's version footer (`D11.3`, ADR-0054 §5).
 *
 * **What is under test is the channel, not the string.** The value is a Vite
 * `define` — a textual substitution, invisible to the type checker's usual
 * reach and to every other test in this suite — installed by `vite.config.ts`
 * for the build and by `vitest.config.ts` for the runner, both from
 * `app-version.ts`. Two things can go wrong there and nothing else would say
 * so: the constant can be missing under one of the two configs, in which case
 * it renders as the literal `undefined`; and it can drift from the tracked
 * source it claims to come from. So the expectation is built by reading
 * `package.json` here, which is the only way this file can assert
 * *provenance* rather than repeat a number.
 *
 * Through `renderApp` rather than by rendering `AppSidebar`, because the claim
 * includes where the string hangs: the footer is a region `D8.5` deliberately
 * removed and ADR-0054 §5 deliberately brought back, and a widget rendered on
 * its own would prove neither the mount nor the region.
 */

describe("the sidebar's version footer", () => {
  it("renders the version from apps/admin/package.json", async () => {
    renderApp({ initialPath: "/", store: authenticatedAs() });

    /*
     * The shell first: `renderApp` boots the session before anything renders
     * (ADR-0033), so a synchronous query here would race the gate.
     */
    await screen.findByRole("heading", { name: "Dashboard", level: 1 });

    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    expect(footer).toHaveTextContent(`v${packageJson.version}`);
    /*
     * Not the literal word — the failure a missing `define` produces. A
     * `toHaveTextContent` on the version alone would pass against
     * "vundefined" for a version of `undefined`, and would keep passing for
     * every version that is a prefix of another.
     */
    expect(footer?.textContent).not.toContain("undefined");
  });
});
