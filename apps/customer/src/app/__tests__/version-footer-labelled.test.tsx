import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
 * The sidebar's version footer, for a labelled build (ADR-0081 §3, `D32.2`;
 * the label alone since `D32.5`).
 *
 * The runner's `define` is built from nothing set (`vitest.config.ts`), so a
 * label can only reach this suite by replacing the constant the configuration
 * door exports — which is what a build with `--build-arg APP_VERSION=…` hands
 * the same door. The rest of the door is the real one. The substitution itself
 * is `version-footer.test.tsx`'s claim, and that no commit reaches the bundle
 * is `app-version.test.ts`'s.
 */
vi.mock("@/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/config")>()),
  APP_VERSION: "9.9.9",
}));

beforeEach(() => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
});

describe("the sidebar's version footer", () => {
  it("the footer shows the release label alone", async () => {
    renderApp({ initialPath: "/", store: authenticated() });

    await screen.findByRole("button", { name: "Account" });

    const footer = document.querySelector('[data-slot="sidebar-footer"]');

    /*
     * The label as given, and nothing beside it: no separator and no commit,
     * which is the API's `/health` fact alone (`D32.5`).
     */
    expect(footer?.textContent).toBe("9.9.9");
  });
});
