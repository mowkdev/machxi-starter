import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

/**
 * The sidebar's version footer, unlabelled (ADR-0081 §1–§3, the delta on
 * ADR-0054 §5; `D32.2`).
 *
 * **What is under test is the channel, not the string.** The value is a Vite
 * `define` — a textual substitution, invisible to the type checker's usual
 * reach and to every other test in this suite — installed by `vite.config.ts`
 * for the build and by `vitest.config.ts` for the runner, both from
 * `app-version.ts`. The runner's is built from nothing set, which is every
 * local build's state, so this case sees the real substitution with no mock
 * between it and the footer: a missing `define` renders the literal
 * `undefined`, and a label the catalogue decorates renders `vdev`.
 *
 * The labelled build is `version-footer-labelled.test.tsx`, which has to
 * replace the configuration door to get a label at all.
 *
 * Through `renderApp` rather than by rendering `AppSidebar`, because the claim
 * includes where the string hangs: the footer is a region `D8.5` deliberately
 * removed and ADR-0054 §5 deliberately brought back, and a widget rendered on
 * its own would prove neither the mount nor the region.
 */

describe("the sidebar's version footer", () => {
  it("the footer shows dev and no commit when unset", async () => {
    renderApp({ initialPath: "/", store: authenticatedAs() });

    /*
     * The shell first: `renderApp` boots the session before anything renders
     * (ADR-0033), so a synchronous query here would race the gate.
     */
    await screen.findByRole("heading", { name: "Dashboard", level: 1 });

    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    /*
     * Exactly the word, which is three claims at once: the label is `dev`
     * rather than a manifest's `0.0.0`, nothing decorates it (`vdev`), and no
     * separator or commit follows it.
     */
    expect(footer?.textContent).toBe("dev");
  });
});
