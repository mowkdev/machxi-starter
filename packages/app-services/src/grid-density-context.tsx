import { DEFAULT_GRID_DENSITY, type GridDensity } from "@repo/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * How tightly the grids pack their rows, bound to React (`D11.6`, ADR-0053 §2,
 * ADR-0054 §6).
 *
 * The theme's sibling, and deliberately built to the same shape: the account
 * owns the fact, `app/providers/settings.tsx` renders this and connects it,
 * and the two surfaces that change it — the page-header toggle and the
 * Preferences card — both call `setDensity` and know nothing about requests.
 *
 * **Two things the theme has that this does not, both on purpose.**
 *
 * There is *no device cache*. The theme writes `localStorage` because the
 * first paint happens before there is a session to ask and a login screen that
 * flashes light is a real defect; a grid renders only inside the dashboard,
 * below the settings gate, so by the time a table exists the account's answer
 * has arrived. A second copy of this fact would be a second owner with nothing
 * reading it.
 *
 * And there is *no side effect on apply*. The theme toggles a class on
 * `<html>`; a density is a prop the tables read, so the state is the whole of
 * it. What remains identical is the part that is load-bearing: the adoption
 * latch below.
 */

export interface GridDensityView {
  readonly density: GridDensity;
  readonly setDensity: (density: GridDensity) => void;
}

/**
 * No default value, so `useGridDensity` outside a provider is a loud failure
 * rather than a control that silently toggles nothing — the same call
 * `ThemeContext` makes. It is not the same thing as `@repo/grid`'s own
 * fallback: a table with no provider above it renders comfortable, because a
 * table is allowed to exist without an account; a *control* that writes a
 * setting is not.
 */
const GridDensityContext = createContext<GridDensityView | null>(null);

export interface GridDensityProviderProps {
  readonly children: ReactNode;
  /**
   * The account's density, once `GET /settings` has answered. `undefined`
   * while the app is anonymous or the read failed, which leaves the mode at
   * the contract's default for as long as that is true.
   */
  readonly adopted?: GridDensity | undefined;
  /**
   * Where a change also goes when there is an account to remember it — the
   * coalescing writer of ADR-0045, so a density toggle and a column drag in
   * the same second are one `PATCH`.
   */
  readonly publish?: ((density: GridDensity) => void) | undefined;
}

export const GridDensityProvider = ({
  children,
  adopted,
  publish,
}: GridDensityProviderProps) => {
  /*
   * **Seeded from `adopted`, not adopted into afterwards.** The theme starts
   * from its device cache and takes the account's answer in an effect, which
   * costs it one render at the old value — invisible there, because `main.tsx`
   * had already painted that value before React existed. Here the equivalent
   * would be a table drawn Comfortable for one frame and then re-drawn
   * Compact, on every load, for an operator who chose Compact. On a cold boot
   * the settings gate above this provider (ADR-0045 §The client) has already
   * settled the query, so `adopted` is the account's answer on the render this
   * mounts and the first paint is right; the effect below then handles every
   * *later* answer, which is what makes the two paths one behaviour rather
   * than two.
   *
   * **"Cold boot" is load-bearing, and it was not always true.** Until `D13.6`
   * nothing evicted the settings query when a principal changed, and it is
   * cached with `staleTime: Infinity`, so a sign-out and a sign-in *in the same
   * tab* left the previous account's resource in the cache: the gate did not
   * hold, and `adopted` seeded with what the last operator chose. That was true
   * of the theme, the locale and the grid arrangements exactly as it was of
   * this (ADR-0045 §The client, since `D6.3`) — `D11.6` found it rather than
   * introduced it, and recorded it rather than bending one setting around a
   * cache rule that belongs to all four. An app is responsible for evicting at
   * a principal change; each of the two does it today in its own
   * `app/providers/principal-cache.tsx`, by dropping every cached resource and
   * remounting the settings subtree — the whole app under it — so that a boot
   * and a sign-in reach this provider the same way. The fix stayed out of here
   * for the reason `D11.6` gave, and it is still not this provider's to make.
   */
  const [density, setDensityState] = useState<GridDensity>(
    adopted ?? DEFAULT_GRID_DENSITY,
  );

  /*
   * The adoption latch, and it is the reason this is not `adopted ?? state`.
   * The settings query answers again — a refetch, another mutation's response
   * — and each answer is the account's *last saved* value; without the latch,
   * the render after an operator's toggle would spring the grid back to what
   * the server said before the write landed.
   */
  const lastAdopted = useRef<GridDensity | null>(adopted ?? null);

  useEffect(() => {
    if (adopted === undefined || adopted === lastAdopted.current) return;

    lastAdopted.current = adopted;
    setDensityState(adopted);
  }, [adopted]);

  const setDensity = useCallback(
    (next: GridDensity) => {
      setDensityState(next);
      publish?.(next);
    },
    [publish],
  );

  const value = useMemo<GridDensityView>(
    () => ({ density, setDensity }),
    [density, setDensity],
  );

  return (
    <GridDensityContext.Provider value={value}>
      {children}
    </GridDensityContext.Provider>
  );
};

/**
 * The mode alone, for the surfaces that only *render* at it.
 *
 * **Reading is allowed without a provider; writing is not**, and the pair
 * below is that distinction rather than a convenience. A table is allowed to
 * exist with no account above it — a package suite, a screen mounted before
 * the settings gate, a second app that has not wired this yet — and the
 * honest answer there is the contract's default, which is what `@repo/grid`
 * would have used anyway. A *control* with no provider is a different thing:
 * it is a button that changes nothing, and {@link useGridDensity} throws
 * rather than ship one.
 */
export const useGridDensityValue = (): GridDensity =>
  useContext(GridDensityContext)?.density ?? DEFAULT_GRID_DENSITY;

export const useGridDensity = (): GridDensityView => {
  const value = useContext(GridDensityContext);

  if (value === null) {
    throw new Error(
      "useGridDensity must be used within a <GridDensityProvider>",
    );
  }

  return value;
};
