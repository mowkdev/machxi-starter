import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  createProfileHandlers,
  createProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The banner slot's consumer in this app (`D12.9`, ADR-0048 §3, ADR-0046 §10).
 *
 * **Both directions, because only one of them is the bug this exists to
 * prevent.** That the notice renders when asked is the easy half; that the
 * shell leaves *no node at all* when it is off is the half ADR-0048 §3 is
 * explicit about, since an empty element in the banner region would take height
 * from every page below it and nothing else in the suite would notice.
 *
 * The suite's default is off — `renderApp`'s `pseudoNotice` defaults to `false`
 * and `vitest.config.ts` pins `VITE_I18N_PSEUDO` to `"false"` — so the negative
 * case is also a statement about every other test file in this app.
 *
 * **And it is the second half of the same claim the pseudo-locale walk makes.**
 * That suite proves nothing on a screen escaped the lens; this one proves the
 * build wearing the lens says so out loud, in a sentence that came out of a
 * catalogue like every other.
 */

/** The English catalogue's opening, which is what the suite renders in. */
const NOTICE = /Pseudo-locale is on/;

/*
 * The harness answers every request through MSW with
 * `onUnhandledRequest: "error"`, so the endpoints the visited screens read are
 * installed here — the same pair the pseudo-locale walk installs, for the same
 * reason: a screen that fetched something unanswered would fail this file for a
 * reason that has nothing to do with a banner.
 */
beforeEach(() => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createProfileHandlers(createProfileMockState()),
  );
});

describe("the pseudo-locale notice", () => {
  it("renders into the shell's banner region when the channel says so", async () => {
    renderApp({ initialPath: "/", pseudoNotice: true, store: authenticated() });

    const notice = await screen.findByRole("status");

    expect(notice).toHaveTextContent(NOTICE);
    expect(notice).toHaveAttribute("data-variant", "info");

    /*
     * Inside the banner region rather than merely on the page: the slot is what
     * this step spends, and a notice rendered anywhere else would satisfy a
     * text query just as well.
     */
    expect(
      document.querySelector('[data-slot="banner-region"]')?.contains(notice),
    ).toBe(true);
  });

  it("is not dismissible, because a warning about the build must stay true", async () => {
    renderApp({ initialPath: "/", pseudoNotice: true, store: authenticated() });

    const notice = await screen.findByRole("status");

    /*
     * Any button, not one named "Dismiss": that name is `UiStrings.dismiss`,
     * which this test does not own, and a negative query filtered on a string
     * someone else can rename goes green while the control it forbids sits on
     * screen. The notice renders no other control, so the filter buys nothing
     * and costs the assertion its teeth.
     */
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves no node in the banner region when it is off", async () => {
    renderApp({ initialPath: "/", store: authenticated() });

    await screen.findByRole("heading", { name: "Your account" });

    /*
     * Not an empty `div`: the region renders nothing at all, which is the
     * property the page's height budget below it depends on (ADR-0048 §3).
     */
    expect(
      document.querySelector('[data-slot="banner-region"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("shows on the account sections too, because it warns about the build and not about a screen", async () => {
    renderApp({
      initialPath: "/account/preferences",
      pseudoNotice: true,
      store: authenticated(),
    });

    /*
     * The notice hangs off `_dashboard`, not off a page, so every address
     * behind the guard carries it. Asserted on a second route rather than
     * assumed from the layout's file path: a reader placed in a page component
     * would pass the two cases above and fail here, which is exactly the
     * regression this case is for.
     */
    expect(await screen.findByRole("status")).toHaveTextContent(NOTICE);
  });
});
