import { listQuerySearchSchema, type ListQuerySearch } from "@repo/contracts";
import { useRouterState, type HistoryState } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * How a record surface remembers the list it was opened from (ADR-0044).
 *
 * A record URL carries **only the record**: `/staff/3f2a…`, not
 * `/staff/3f2a…?offset=40&limit=50&sort=-email&filter[status]=active`. That
 * is the whole of the decision, and everything here exists because of what it
 * costs — the requirement it removed has to come back some other way.
 *
 * ## The requirement, and the trap
 *
 * Closing a record must return the operator to the page they opened it from.
 * ADR-0040 answered that with `retainSearchParams`, which put the list state
 * in the record's URL; this replaces it with the navigation's **history
 * state**, which is per-entry, survives a reload (the browser keeps
 * `history.state`), survives Back and Forward, and is **absent for a cold
 * link** — which is exactly right, because a colleague who was sent a record
 * never had the sender's view.
 *
 * The trap, and the reason a carrier is needed at all rather than just
 * deleting the middleware: for the `dialog` and `drawer` surfaces the list
 * route renders the grid **and** the `Outlet`, so the grid behind the overlay
 * reads *the parent route's search* — and the parent route's search, while a
 * record is open, is the record URL's. Strip the params with nothing in their
 * place and the drawer floats over page one of an unfiltered grid, and closing
 * it lands the operator there. Anyone re-deriving this from "just drop the
 * params" will ship that.
 *
 * ## The rule
 *
 * **The URL owns view state, preferences own ergonomics, history state owns
 * the way back** — ADR-0041's two-way split, now three. Nothing durable,
 * shareable or reproducible belongs here; this is one navigation's memory of
 * where it came from.
 */

declare module "@tanstack/react-router" {
  /**
   * Typed so `state.list` is not a stringly-typed guess at every call site
   * (the same reason ADR-0043's mutation `meta` is augmented rather than
   * indexed). Optional because every navigation that is not opening a record
   * has no list to carry, and a cold link has none either.
   */
  interface HistoryState {
    list?: ListQuerySearch;
  }
}

/**
 * A location's raw search as a whole list state.
 *
 * `safeParse` rather than `parse`: this runs in a hook on every route, and a
 * screen with no list state at all (`/login?redirect=…`) must not throw its way
 * out of a render. Unknown keys are dropped by the schema, so what comes back
 * is a list state or the defaults, never a surprise.
 */
const normalize = (search: unknown): ListQuerySearch => {
  const parsed = listQuerySearchSchema.safeParse(search);

  return parsed.success ? parsed.data : listQuerySearchSchema.parse({});
};

/**
 * The list state a grid should render, which is not always the URL's.
 *
 * On the list route they are the same object. On a record route the URL has no
 * list params by design, so the grid behind the overlay reads the snapshot the
 * opening navigation carried — and falls back to the route's own search when
 * there is none, which is the cold-link case rendering a bare list.
 */
export const useCarriedListState = (
  search: ListQuerySearch,
): ListQuerySearch => {
  const carried = useRouterState({ select: (state) => state.location.state });

  return carried.list ?? search;
};

/**
 * What {@link useRecordNavigation} hands back.
 *
 * **Written out rather than inferred** (`D14.9`, ADR-0062 §3), and the reason
 * is not tidiness. Under project references a consumer reads this package's
 * emitted `.d.ts` rather than its source, and a declaration emit writes an
 * **expanded** copy of an inferred type in place of the alias the source
 * named. The expansion of `{ list: normalize(search) }` stopped satisfying the
 * router's own `state` option, so four call sites in `apps/admin` went red
 * against a package whose source had not changed a character. `HistoryState`
 * is the type that option takes, so naming it here is what keeps the emitted
 * surface assignable — intersected with the `list` this hook always sets,
 * because `HistoryState` itself declares it *optional* and an `openState`
 * without one is not a thing this hook can hand back.
 */
export interface RecordNavigation {
  /**
   * What an entry point spreads into its `navigate` or `<Link>`: the list
   * state as history state, and **no `search`**, so the record's URL is the
   * record's alone.
   *
   * Read from `location.search` rather than from a `useSearch({ from })`,
   * because a shared helper cannot name a route — and **validated on the way
   * in**, which is the difference between the two. `useSearch` yields the
   * route's validated object; `location.search` is what the URL literally
   * carried, so on a bare `/staff` it is `{}`. Carrying that forward hands the
   * grid a state with no `sort` and no `filters` and crashes it on the first
   * `.map`. The schema is the one that owns what an absent param means, so the
   * carrier asks it.
   */
  readonly openState: HistoryState & { readonly list: ListQuerySearch };
  /**
   * What a close navigation passes as its `search`: the view the operator
   * left, or nothing at all when this record was reached by a link and there
   * is no view to return to.
   */
  readonly closeSearch: ListQuerySearch | Record<string, never>;
}

/**
 * The two halves of the round trip, for the entry points and the surfaces.
 *
 * One helper rather than a rule each resource restates, and it never learns a
 * resource name — `shared/grid` does not know what a "staff" is (ADR-0038),
 * so both halves take the destination from their caller and only the *carrying*
 * is decided here.
 */
export const useRecordNavigation = (): RecordNavigation => {
  const search = useRouterState({ select: (state) => state.location.search });
  const carried = useRouterState({
    select: (state) => state.location.state.list,
  });

  /*
   * Memoised on the location's own values, and that is a correctness
   * requirement rather than a performance one. A row-action list is itself a
   * `useMemo`, so a carrier rebuilt on every render would either be excluded
   * from its dependencies — capturing the list state as it was when the actions
   * were built, and carrying **that** into a record opened three pages later —
   * or included, and rebuild the actions on every render. TanStack Router keeps
   * one location object per navigation, so keying on it gives a reference that
   * changes exactly when the answer does.
   */
  return useMemo(
    () => ({
      openState: { list: normalize(search) },
      closeSearch: carried ?? {},
    }),
    [search, carried],
  );
};
