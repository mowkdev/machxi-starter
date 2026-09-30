import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { server } from "@repo/app-kit/testing";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The sidebar's version footer, unlabelled (ADR-0081 §1–§3, the delta on
 * ADR-0054 §5; `D32.2`).
 *
 * The admin's case of the same name, for this app's shell. What is under test
 * is the channel: the value is a Vite `define` installed by `vite.config.ts`
 * and `vitest.config.ts` from `app-version.ts`, and the runner's is built from
 * nothing set — every local build's state — so this case sees the real
 * substitution with no mock between it and the footer. A missing `define`
 * renders the literal `undefined`; a label the catalogue decorates renders
 * `vdev`.
 *
 * The labelled build is `version-footer-labelled.test.tsx`, which has to
 * replace the configuration door to get a label at all.
 */
beforeEach(() => {
  /*
   * The shell's header reads `GET /user/orgs` for the switcher (ADR-0067 §6),
   * and `onUnhandledRequest: "error"` makes a missing handler a failure at the
   * boundary rather than an empty screen.
   */
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

describe("the sidebar's version footer", () => {
  it("the footer shows dev and no commit when unset", async () => {
    renderApp({ initialPath: "/", store: authenticated() });

    // The shell first: the session boots before anything renders (ADR-0033).
    await screen.findByRole("button", { name: "Account" });

    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    /*
     * Exactly the word: the label is `dev` rather than a manifest's `0.0.0`,
     * nothing decorates it (`vdev`), and no separator or commit follows it.
     */
    expect(footer?.textContent).toBe("dev");
  });
});
