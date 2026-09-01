import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { profileKeys } from "@/entities/profile";
import { createSessionStore } from "@/shared/api/session-store";
import { useGridDensity } from "@/shared/density";
import { useTheme } from "@/shared/theme";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@/test/msw/server";
import { userPrincipal } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * One principal's cache does not become the next one's (`D13.6`).
 *
 * The defect this suite pins was found at `D11.11` and inherited here through
 * D12's close: the settings query is cached with `staleTime: Infinity`
 * (ADR-0045 §The client as carried by ADR-0053), so a sign-out and a sign-in
 * **in the same tab** leave the previous account's resource in the cache, the
 * settings gate never holds, and the second customer comes up in the first
 * one's theme, language and density.
 *
 * **Two cases, because this app has two ways to reach one customer.** The
 * second is D13's own: an impersonated session carries the same customer id as
 * the customer's own session and a different *actor* (ADR-0057 §4), so "a
 * different principal" is identity **and** actor here, and the seam keys on
 * both.
 */

const FIRST = "0198c1f0-0000-7000-8000-0000000000c1";
const SECOND = "0198c1f0-0000-7000-8000-0000000000d2";
const OPERATOR = "0198c1f0-0000-7000-8000-0000000000e3";

const ThemeProbe = () => {
  const { theme } = useTheme();

  return <output data-testid="theme">{theme}</output>;
};

const DensityProbe = () => {
  const { density } = useGridDensity();

  return <output data-testid="density">{density}</output>;
};

const renderFor = (
  store: ReturnType<typeof createSessionStore>,
): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(
    <SettingsProvider fallback={<p>Loading settings…</p>}>
      <ThemeProbe />
      <DensityProbe />
    </SettingsProvider>,
    { store },
  );

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("a second principal in one tab", () => {
  it("does not adopt the first principal's settings", async () => {
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "compact",
      grids: {},
    });

    server.use(...createSettingsHandlers(state));

    const store = createSessionStore();

    store.setSession({
      accessToken: "first-access-token",
      principal: userPrincipal({ id: FIRST, email: "first@machxi.local" }),
    });

    const { queryClient } = renderFor(store);

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    });
    expect(screen.getByTestId("density")).toHaveTextContent("compact");
    expect(state.seen.reads).toBe(1);

    /*
     * The settings row is what this step was routed here for, but the rule is
     * the cache's: an entry belonging to no gate and no provider must go too,
     * or the eviction is a special case for the one resource somebody noticed.
     */
    queryClient.setQueryData(profileKeys.detail(), {
      id: FIRST,
      email: "first@machxi.local",
    });

    // What the endpoint answers from here is the *second* customer's row.
    state.settings = {
      theme: "light",
      locale: "en",
      gridDensity: "comfortable",
      grids: {},
    };

    act(() => {
      store.setSession({
        accessToken: "second-access-token",
        principal: userPrincipal({ id: SECOND, email: "second@machxi.local" }),
      });
    });

    // The read is the property: a cache entry that survived the change would
    // answer without one, which is precisely how the first customer's
    // preferences reach the second.
    await waitFor(() => {
      expect(state.seen.reads).toBe(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
    });
    expect(screen.getByTestId("density")).toHaveTextContent("comfortable");
    expect(queryClient.getQueryData(profileKeys.detail())).toBeUndefined();
  });

  it("does not adopt them across an impersonation of the same customer", async () => {
    const state = createSettingsMockState({
      theme: "dark",
      locale: "en",
      gridDensity: "compact",
      grids: {},
    });

    server.use(...createSettingsHandlers(state));

    const store = createSessionStore();

    store.setSession({
      accessToken: "own-access-token",
      principal: userPrincipal({ id: FIRST, email: "first@machxi.local" }),
    });

    renderFor(store);

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    });
    expect(state.seen.reads).toBe(1);

    state.settings = {
      theme: "light",
      locale: "en",
      gridDensity: "comfortable",
      grids: {},
    };

    /*
     * The same customer id, reached the other way (ADR-0057 §4). The subject of
     * `GET /settings` is `ctx.principal` either way, so the row is the same
     * row — what changes is who is acting, and the seam is not asked to derive
     * that the two sessions happen to share a subject.
     */
    act(() => {
      store.setSession({
        accessToken: "impersonated-access-token",
        principal: userPrincipal({
          id: FIRST,
          email: "first@machxi.local",
          impersonatedBy: { id: OPERATOR, email: "operator@machxi.local" },
        }),
      });
    });

    await waitFor(() => {
      expect(state.seen.reads).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
    });
  });
});
