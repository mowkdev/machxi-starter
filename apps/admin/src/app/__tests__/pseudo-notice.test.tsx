import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { authenticatedAs } from "@/test/principals";

/**
 * The banner slot's proving consumer (`D8.7`, ADR-0048 §3).
 *
 * **Both directions, because only one of them is the bug this exists to
 * prevent.** That the notice renders when asked is the easy half; that the
 * shell leaves *no node at all* when it is off is the half ADR-0048 §3 is
 * explicit about, since an empty element in the banner region would shift
 * every grid page's height budget and nothing else in the suite would notice.
 *
 * The suite's default is off — `renderApp`'s `pseudoNotice` defaults to
 * `false` and the admin's vitest config pins `VITE_I18N_PSEUDO` to `"false"`
 * — so the negative case is also a statement about every other test file here.
 */

const NOTICE = /Pseudo-locale is on/;

beforeEach(() => {
  server.use(...createProfileHandlers(createProfileMockState()));
});

describe("the pseudo-locale notice", () => {
  it("renders into the shell's banner region when the channel says so", async () => {
    renderApp({
      initialPath: "/",
      pseudoNotice: true,
      store: authenticatedAs(),
    });

    const notice = await screen.findByRole("status");

    expect(notice).toHaveTextContent(NOTICE);
    expect(notice).toHaveAttribute("data-variant", "info");

    /*
     * Inside the banner region rather than merely on the page: the slot is
     * what this step exists to prove, and a notice rendered anywhere else
     * would satisfy a text query just as well.
     */
    expect(
      document.querySelector('[data-slot="banner-region"]')?.contains(notice),
    ).toBe(true);
  });

  it("is not dismissible, because a warning about the build must stay true", async () => {
    renderApp({
      initialPath: "/",
      pseudoNotice: true,
      store: authenticatedAs(),
    });

    const notice = await screen.findByRole("status");

    /*
     * Any button, not one named "Dismiss": that name is `UiStrings.dismiss`,
     * which this test does not own, and a negative query filtered on a string
     * someone else can rename goes green while the control it forbids sits
     * on screen. The notice renders no other control, so the filter buys
     * nothing and costs the assertion its teeth.
     */
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves no node in the banner region when it is off", async () => {
    renderApp({ initialPath: "/", store: authenticatedAs() });

    await screen.findByRole("heading", { name: "Dashboard" });

    /*
     * Not an empty `div`: the region renders nothing at all, which is the
     * property the height budget below it depends on (ADR-0048 §3).
     */
    expect(
      document.querySelector('[data-slot="banner-region"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
