import type { GridPreferencesV1 } from "@repo/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "@/app/providers/settings";
import { profileKeys } from "@/entities/profile";
import { createSessionStore } from "@/shared/api/session-store";
import { useGridPreferences } from "@/shared/grid/use-grid-preferences";
import { useTheme } from "@/shared/theme";
import {
  createSettingsHandlers,
  createSettingsMockState,
} from "@/test/msw/handlers/settings.handlers";
import { server } from "@/test/msw/server";
import { staffPrincipal } from "@/test/principals";
import { renderWithProviders } from "@/test/render";

/**
 * One principal's cache does not become the next one's (`D13.6`).
 *
 * The defect this suite pins was found at `D11.11` and belongs to every
 * deliverable that put a key in the settings row — D6, D7, `D11.6`, `D11.10` —
 * which is why it was carried rather than bent around one setting. The
 * mechanism is exact: the settings query is cached with `staleTime: Infinity`
 * (ADR-0045 §The client), so a sign-out and a sign-in **in the same tab** leave
 * the previous account's resource in the cache, the settings gate never holds,
 * and the second operator comes up in the first one's theme, language, density
 * and grid arrangements.
 *
 * The probes are the two ends of the resource: the grid width comes through
 * ADR-0041's synchronous `read` — the reason the gate exists at all — and the
 * theme through the adoption latch in `@repo/app-services`.
 */

const DEFAULTS = { order: ["email", "status"] } as const;

const entry = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

const FIRST = "0198c1f0-0000-7000-8000-0000000000a1";
const SECOND = "0198c1f0-0000-7000-8000-0000000000b2";

/** Reads what a grid *would* read, through whatever adapter is in context. */
const GridProbe = () => {
  const [preferences] = useGridPreferences({
    gridId: "staff",
    movable: DEFAULTS.order,
    storage: undefined,
  });

  return (
    <output data-testid="width">{preferences.sizing.email ?? "auto"}</output>
  );
};

const ThemeProbe = () => {
  const { theme } = useTheme();

  return <output data-testid="theme">{theme}</output>;
};

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
      grids: { staff: entry(360) },
    });

    server.use(...createSettingsHandlers(state));

    const store = createSessionStore();

    store.setSession({
      accessToken: "first-access-token",
      principal: staffPrincipal(["admin"], {
        id: FIRST,
        email: "first@machxi.local",
      }),
    });

    const { queryClient } = renderWithProviders(
      <SettingsProvider fallback={<p>Loading settings…</p>}>
        <GridProbe />
        <ThemeProbe />
      </SettingsProvider>,
      { store },
    );

    expect(await screen.findByTestId("width")).toHaveTextContent("360");
    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    });
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

    // What the endpoint answers from here is the *second* operator's row.
    state.settings = {
      theme: "light",
      locale: "en",
      gridDensity: "comfortable",
      grids: { staff: entry(220) },
    };

    act(() => {
      store.setSession({
        accessToken: "second-access-token",
        principal: staffPrincipal(["admin"], {
          id: SECOND,
          email: "second@machxi.local",
        }),
      });
    });

    // The read is the property: a cache entry that survived the change would
    // answer without one, which is precisely how the first operator's
    // arrangement reaches the second.
    await waitFor(() => {
      expect(state.seen.reads).toBe(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("width")).toHaveTextContent("220");
    });
    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
    });

    expect(queryClient.getQueryData(profileKeys.detail())).toBeUndefined();
  });
});
